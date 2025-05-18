require("dotenv").config();
const express = require("express");
const router = express.Router();
const {
  QdrantVectorStore,
} = require("@langchain/community/vectorstores/qdrant");
const { VertexAIEmbeddings } = require("@langchain/google-vertexai");
const path = require("path");
const redis = require("../config/valkeyClient");
const ValkeyMemory = require("../memory/valkeyMemory");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const os = require('os')
const fs = require('fs')

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

const embeddings = new VertexAIEmbeddings({
  model: "text-embedding-004",
});

router.get("/", async (req, res) => {
  try {
    const userQuery = req.query.q;
    const userId = req.query.userId;
    if (!userQuery || !userId) {
      return res
        .status(400)
        .json({ error: "Missing 'q' or 'userId' query parameter" });
    }
    const memory = new ValkeyMemory(redis, userId);
    const chatHistory = await memory.getHistory();
    const historyText = chatHistory
      .map((m) => `User: ${m.user}\nAssistant: ${m.bot}`)
      .join("\n");

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: "http://localhost:6333",
        collectionName: "pdf-docs",
      }
    );

    // Define filter
    const filter = {
      must: [
        {
          key: "userId",
          match: {
            value: userId
          }
        }
      ]
    };
    
    
    let results;
    
    try {
      results = await vectorStore.similaritySearch(userQuery, 5, filter);
      console.log(`Found ${results.length} results with filter`);
      
      if (results.length === 0) {
        console.log("No results found with filter, trying manual filtering...");
        const unfiltered = await vectorStore.similaritySearch(userQuery, 10);
        console.log(`Found ${unfiltered.length} results without filter`);
        
        if (unfiltered.length > 0) {
          results = unfiltered.filter(doc => 
            doc.metadata && doc.metadata.userId === userId
          );
          
          
          if (results.length === 0) {
            console.log("No relevant documents found for this user after manual filtering");
          }
        }
      }
    } catch (error) {
      console.error("Error during similarity search:", error);
      const unfiltered = await vectorStore.similaritySearch(userQuery, 10);
      results = unfiltered.filter(doc => 
        doc.metadata && doc.metadata.userId === userId
      );
      console.log(`Found ${results.length} results after error recovery and manual filtering`);
    }
    
    results = results || [];
    
    
    if (results.length === 0) {
      console.log("No relevant documents found to answer the query");
    }

    const SYSTEM_PROMPT = `
    You are a helpful and intelligent assistant that answers user questions based on the context provided from a PDF document, along with their previous conversation history.
    
    Instructions:
    - Answer based strictly on the PDF content and prior conversation context.
    - If the user's question is related to the PDF, respond accurately and helpfully.
    - If the user asks for a little more detail, elaborate just enough to give a clearer explanation, but stay concise and on-topic.
    - If a question can't be answered from the PDF or previous chat history, politely inform the user.
    - Use chat history to maintain context across multiple questions and provide continuity in responses.
    - If the user greets you (e.g., "Hi", "Hello"), respond politely and maintain a friendly, professional tone.
    
    PDF Context:
    ${JSON.stringify(results)}
    
    Chat History:
    ${historyText}
    
    Current User Question:
    ${userQuery}
    `;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const geminiResponse = await model.generateContent(SYSTEM_PROMPT);
    const responseText = geminiResponse?.response.text();
    const formattedAnswer = responseText.replace(/\n/g, "<br/>");

    await memory.addToHistory(userQuery, responseText);

    res.status(200).json({
      answer: formattedAnswer,
      sources: results,
    });
  } catch (error) {
    console.error("Error in /info query route:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
