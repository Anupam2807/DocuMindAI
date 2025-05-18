// status.js
require('dotenv').config();
const express = require("express");
const { Queue } = require("bullmq");
const router = express.Router();

const uploadQueue = new Queue("upload-queue", {
    connection: {
      host: "localhost",
      port: 6379,
    },
  });


router.get("/", async (req, res) => {
  const { jobId } = req.query;
  if (!jobId) {
    return res.status(400).json({ error: "Missing jobId" });
  }

  const job = await uploadQueue.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const state = await job.getState();

  res.json({ status: state });
});

module.exports = router;
