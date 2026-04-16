import { FastifyInstance } from 'fastify';
import { OffRampService } from '../services/offramp.service';

export default async function offrampRoutes(fastify: FastifyInstance) {
  const offramp = new OffRampService();

  fastify.get('/offramp/rate', async (request, reply) => {
    const rate = await offramp.getRate();
    return { success: true, rate };
  });

  fastify.post('/offramp/initiate', async (request, reply) => {
    const params = request.body as any; 
    const result = await offramp.initiateOffRamp(params);
    return { success: true, result };
  });
}
