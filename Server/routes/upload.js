require('dotenv').config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { v2: cloudinary } = require("cloudinary");
const { Queue } = require("bullmq");
const { VertexAIEmbeddings } = require("@langchain/google-vertexai");
const { QdrantVectorStore } = require("@langchain/community/vectorstores/qdrant");

const queue = new Queue("upload-queue", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "pdf-uploads",
    resource_type: "raw",
    format: async (req, file) => "pdf",
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      return `${file.fieldname}-${uniqueSuffix}-${file.originalname}`;
    },
  },
});

const upload = multer({ storage });

router.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  const userId = req.body.userId || req.query.userId;
  
  if (!userId) {
    return res.status(400).json({ error: "Missing userId parameter" });
  }

  const job = await queue.add("file-ready", JSON.stringify({
    filename: file.filename || file.originalname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    destination: file.path,
    path: file.path,
    size: file.size,
    userId: userId
  }));

  res.json({
    message: "File uploaded successfully",
    filename: req.file.filename,
    cloudinaryUrl: file.path,
    public_id: file.filename,
    jobId: job.id
  });
});

router.get("/user-pdfs", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }

    console.log("Searching for documents for userId:", userId);

    const embeddings = new VertexAIEmbeddings({
      model: "text-embedding-004"
    });

    try {
      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
          url: "http://localhost:6333",
          collectionName: "pdf-docs",
        }
      );

      console.log("Searching for all documents and then filtering by userId...");
      
      const allResults = await vectorStore.similaritySearch("document", 1000);
      
      const results = allResults.filter(doc => 
        doc.metadata && doc.metadata.userId === userId
      );
      
      
      
      const uniqueDocs = Array.from(
        new Map(
          results
            .filter(doc => doc.metadata && doc.metadata.filename && doc.metadata.source)
            .map(doc => [
              doc.metadata.filename,
              {
                filename: doc.metadata.filename,
                uploadDate: doc.metadata.uploadDate || new Date().toISOString(),
                source: doc.metadata.source
              }
            ])
        ).values()
      );

      console.log(`Returning ${uniqueDocs.length} unique documents`);
      
      res.json({
        success: true,
        documents: uniqueDocs
      });
    } catch (error) {
      console.log("Error retrieving documents, returning empty list:", error.message);
      res.json({
        success: true,
        documents: []
      });
    }
  } catch (error) {
    console.error("Error retrieving user PDFs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/delete-document", async (req, res) => {
  try {
    const { userId, filename } = req.body;
    
    if (!userId || !filename) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required parameters: userId and filename are required" 
      });
    }

    console.log(`Attempting to delete document ${filename} for user ${userId}`);

    const embeddings = new VertexAIEmbeddings({
      model: "text-embedding-004"
    });

    try {
      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
          url: "http://localhost:6333",
          collectionName: "pdf-docs",
        }
      );

      const allResults = await vectorStore.similaritySearch("document", 1000);
      
      const matchingDocs = allResults.filter(doc => 
        doc.metadata && 
        doc.metadata.userId === userId && 
        doc.metadata.filename === filename
      );
      
      if (matchingDocs.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Document not found for the specified user"
        });
      }
      
      const idsToDelete = matchingDocs
        .filter(doc => doc.metadata && doc.metadata._id)
        .map(doc => doc.metadata._id);
      
      if (idsToDelete.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Document chunks found but they don't have valid IDs"
        });
      }
      
      // Delete the document chunks from Qdrant
      const deleteResult = await vectorStore.delete({ ids: idsToDelete });
      
      // Also delete the file from Cloudinary if needed
      try {
        // Extract the public_id from the URL pattern in source
        const sampleSource = matchingDocs[0].metadata.source;
        if (sampleSource && sampleSource.includes('cloudinary.com')) {
          const urlParts = sampleSource.split('/');
          const publicIdWithExtension = urlParts[urlParts.length - 1];
          const publicId = publicIdWithExtension.split('.')[0]; // Remove file extension
          
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
            console.log(`Deleted file from Cloudinary: ${publicId}`);
          }
        }
      } catch (cloudinaryError) {
        console.error("Error deleting file from Cloudinary:", cloudinaryError);
      }
      
      console.log(`Successfully deleted ${idsToDelete.length} document chunks`);
      
      res.json({
        success: true,
        message: `Document "${filename}" has been deleted successfully`,
        deletedChunks: idsToDelete.length
      });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ 
        success: false, 
        error: `Error deleting document: ${error.message}` 
      });
    }
  } catch (error) {
    console.error("Error in delete document route:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

module.exports = router;
