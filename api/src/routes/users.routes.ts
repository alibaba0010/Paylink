import { FastifyInstance } from "fastify";
import { DatabaseConnectionError } from "../db/client";
import {
  UserConflictError,
  UserInputError,
  UsersService,
} from "../services/users.service";

const usersService = new UsersService();

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.post("/onboard", async (request, reply) => {
    const { username, walletAddress } = request.body as {
      username?: string;
      walletAddress?: string;
    };

    try {
      const user = await usersService.createUser({
        username: username ?? "",
        walletAddress: walletAddress ?? "",
      });

      return reply.code(201).send({
        success: true,
        user,
      });
    } catch (error) {
      if (error instanceof UserInputError) {
        return reply.code(400).send({
          success: false,
          message: error.message,
        });
      }

      if (error instanceof UserConflictError) {
        return reply.code(409).send({
          success: false,
          message: error.message,
        });
      }

      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }
  });

  fastify.get("/users/by-wallet/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params as { walletAddress: string };

    try {
      const user = await usersService.getUserByWalletAddress(walletAddress);

      if (!user) {
        return reply.code(404).send({
          success: false,
          message: "User not found",
        });
      }

      return {
        success: true,
        user,
      };
    } catch (error) {
      if (error instanceof UserInputError) {
        return reply.code(400).send({
          success: false,
          message: error.message,
        });
      }

      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }
  });

  fastify.get("/users/:username", async (request, reply) => {
    const { username } = request.params as { username: string };

    try {
      const user = await usersService.getUserByUsername(username);

      if (!user) {
        return reply.code(404).send({
          success: false,
          message: "User not found",
        });
      }

      return {
        success: true,
        user,
      };
    } catch (error) {
      if (error instanceof UserInputError) {
        return reply.code(400).send({
          success: false,
          message: error.message,
        });
      }

      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }
  });

  fastify.get("/users/available/:username", async (request, reply) => {
    const { username } = request.params as { username: string };

    try {
      const isAvailable = await usersService.isUsernameAvailable(username);

      return {
        success: true,
        available: isAvailable,
      };
    } catch (error) {
      if (error instanceof DatabaseConnectionError) {
        return reply.code(503).send({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }
  });
}
