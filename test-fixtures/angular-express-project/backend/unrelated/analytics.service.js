// Unrelated analytics service
async function trackEvent(eventName, properties) {
  // logs event to external pipeline
  return { tracked: true, eventName, timestamp: Date.now() };
}

async function computeDailyActiveUsers() {
  return 1250;
}

module.exports = {
  trackEvent,
  computeDailyActiveUsers,
};
