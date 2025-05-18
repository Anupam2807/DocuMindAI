const { Queue } = require('bullmq');

const queue = new Queue('upload-queue', {
  redis: { host: 'localhost', port: 6379 },
});

async function cleanQueue() {
  try {
    // Clean completed jobs older than 1 hour (3600000 ms)
    const cleanedCompleted = await queue.clean(3600000, 'completed');
    console.log(`Cleaned ${cleanedCompleted.length} completed jobs.`);
    
    // Clean failed jobs older than 1 hour
    const cleanedFailed = await queue.clean(3600000, 'failed');
    console.log(`Cleaned ${cleanedFailed.length} failed jobs.`);
  } catch (error) {
    console.error('Error cleaning the queue:', error);
  }
}

cleanQueue().catch(console.error);
