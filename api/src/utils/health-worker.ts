import axios from "axios";

const PRODUCTION_API_URL =
  process.env.PRODUCTION_API_URL || "https://paylink-zlow.onrender.com";
const PRODUCTION_FRONTEND_URL =
  process.env.PRODUCTION_FRONTEND_URL || "https://paylink-brown.vercel.app";

const LOCAL_API_URL = `http://localhost:${process.env.PORT || 8001}`;
const LOCAL_FRONTEND_URL = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

const IS_PROD = process.env.NODE_ENV === "production";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Health worker to ping production URLs to avoid inactivity spin-down.
 * Note: Render's free tier spins down after 15 minutes of inactivity.
 * Pinging every 2-4 days as requested might not keep a free instance alive
 * continuously, but it ensures regular activity logs.
 */
export function startHealthWorker() {
  console.log("Health worker initialized");

  const ping = async () => {
    const urls = IS_PROD
      ? [`${PRODUCTION_API_URL}/health`, PRODUCTION_FRONTEND_URL]
      : [`${LOCAL_API_URL}/health`, LOCAL_FRONTEND_URL];

    console.log(
      `[HealthWorker] Running scheduled ping to ${urls.length} targets...`,
    );

    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        console.log(
          `[HealthWorker] Successfully pinged ${url}: Status ${response.status}`,
        );
      } catch (error: any) {
        console.error(`[HealthWorker] Failed to ping ${url}: ${error.message}`);
      }
    }

    // Schedule next ping between 2 and 4 days
    const minDays = 2;
    const maxDays = 4;
    const randomDays = Math.random() * (maxDays - minDays) + minDays;
    const delay = randomDays * MS_PER_DAY;

    const nextPingDate = new Date(Date.now() + delay);
    console.log(
      `[HealthWorker] Next health check scheduled for: ${nextPingDate.toLocaleString()} (in ${randomDays.toFixed(2)} days)`,
    );

    setTimeout(ping, delay);
  };

  // Initial ping after 30 seconds to allow server to fully start
  setTimeout(ping, 30000);
}
