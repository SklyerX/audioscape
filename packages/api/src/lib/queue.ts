import { Queue } from "bullmq";

export const audio_queue = new Queue("audio-analysis", {
  connection: {
    url: process.env.REDIS_CONNECTION_STRING,
  },
});
