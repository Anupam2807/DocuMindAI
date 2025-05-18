// memory/valkeyMemory.js
class ValkeyMemory {
    constructor(redis, userId) {
      this.redis = redis;
      this.key = `chat_history:${userId}`;
      this.maxHistoryLength = 15; 
    }
  
    async getHistory() {
      const data = await this.redis.get(this.key);
      return data ? JSON.parse(data) : [];
    }
  
    async addToHistory(userInput, botResponse) {
      let history = await this.getHistory();
  
      history.push({ user: userInput, bot: botResponse });
  
      if (history.length > this.maxHistoryLength) {
        history = history.slice(history.length - this.maxHistoryLength);
      }
  
      await this.redis.set(this.key, JSON.stringify(history), "EX", 86400); 
    }
  
    async clear() {
      await this.redis.del(this.key);
    }
  }
  
  module.exports = ValkeyMemory;
  