require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const os = require("os");
const { Worker } = require("bullmq");
const {
  QdrantVectorStore,
} = require("@langchain/community/vectorstores/qdrant");
const { VertexAIEmbeddings } = require("@langchain/google-vertexai");
const { Document } = require("@langchain/core/documents");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { v4: uuidv4 } = require("uuid");

if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  const decoded = Buffer.from(
    process.env.GOOGLE_CREDENTIALS_BASE64,
    "base64"
  ).toString("utf-8");
  const credsPath = path.join(os.tmpdir(), "gcp-creds.json");
  fs.writeFileSync(credsPath, decoded);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
  console.log(
    "Google credentials loaded from base64 and written to temp file."
  );
} else {
  console.error("GOOGLE_CREDENTIALS_BASE64 is not set in .env!");
  process.exit(1);
}

console.log("Worker started and listening...");

const worker = new Worker(
  "upload-queue",
  async (job) => {
    try {
      if (job.name === "file-ready") {
        const data = JSON.parse(job.data);
        console.log("data", data.path);
        const cloudinaryUrl = data.path;
        const userId = data.userId;

        if (!userId) {
          throw new Error("Missing userId in job data");
        }

        const response = await axios.get(cloudinaryUrl, {
          responseType: "arraybuffer",
        });
        const tempFilePath = path.join(
          os.tmpdir(),
          `downloaded-${Date.now()}.pdf`
        );
        fs.writeFileSync(tempFilePath, response.data);
        console.log("PDF downloaded to:", tempFilePath);
        const loader = new PDFLoader(tempFilePath);

        const docs = await loader.load();
        console.log("Number of docs:", docs.length);

        if (docs.length === 0) {
          throw new Error("No content extracted from PDF");
        }

        const docsWithMetadata = docs.map((doc) => {
          return new Document({
            pageContent: doc.pageContent || "Empty document content",
            metadata: {
              ...doc.metadata,
              _id: uuidv4(),
              userId: userId,
              filename: data.originalname,
              uploadDate: new Date().toISOString(),
              source: cloudinaryUrl,
            },
          });
        });

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
          separators: ["\n\n", "\n", " ", ""],
        });

        const splitDocs = await splitter.splitDocuments(docsWithMetadata);

        // Ensure each split document chunk has a unique ID
        splitDocs.forEach((doc) => {
          if (!doc.metadata._id) {
            doc.metadata._id = uuidv4();
          }
        });

        if (splitDocs.length === 0) {
          throw new Error("No valid content chunks generated from PDF");
        }

        console.log(
          `Generated ${splitDocs.length} document chunks with unique IDs`
        );

        const embeddings = new VertexAIEmbeddings({
          model: "text-embedding-004",
        });

        try {
          const vectorStore = await QdrantVectorStore.fromExistingCollection(
            embeddings,
            {
              url: "http://localhost:6333",
              collectionName: "pdf-docs",
            }
          );

          await vectorStore.addDocuments(splitDocs);
        } catch (error) {
          console.log(
            "Collection might not exist yet, creating new one:",
            error.message
          );

          // Create a new collection if it doesn't exist
          const vectorStore = await QdrantVectorStore.fromDocuments(
            splitDocs,
            embeddings,
            {
              url: "http://localhost:6333",
              collectionName: "pdf-docs",
            }
          );
        }

        console.log(
          "All Docs Have Been Added Successfully with userId:",
          userId
        );
        fs.unlinkSync(tempFilePath);
        console.log("Temp file deleted.");
      }
    } catch (err) {
      console.error("Worker job failed:", err);
    }
  },
  {
    connection: {
      host: "localhost",
      port: 6379,
    },
    concurrency: 100,
  }
);
