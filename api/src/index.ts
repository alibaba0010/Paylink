import fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { assertDatabaseConnection } from "./db/supabase-client";
import offrampRoutes from "./routes/offramp.routes";
import paymentRoutes from "./routes/payments.routes";
import paylinkRoutes from "./routes/paylinks.routes";
import userRoutes from "./routes/users.routes";
import payrollRoutes from "./routes/payroll.routes";

dotenv.config();

const server = fastify({ logger: true });
const port = Number(process.env.PORT || 8001);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "*";

server.addHook(
  "onRequest",
  async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Access-Control-Allow-Origin", frontendOrigin);
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  },
);

server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
  return { status: "ok" };
});

server.register(userRoutes);
server.register(paymentRoutes);
server.register(paylinkRoutes);
server.register(offrampRoutes);
server.register(payrollRoutes);

const start = async () => {
  try {
    await assertDatabaseConnection();
    server.log.info("Database connection verified");

    await server.listen({ port });
    console.log(`PayLink API running on port ${port}`);
  } catch (err) {
    server.log.error({ err }, "Failed to start PayLink API");
    process.exit(1);
  }
};

start();
