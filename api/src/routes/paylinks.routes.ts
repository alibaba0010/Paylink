import { FastifyInstance } from 'fastify';

export default async function paylinkRoutes(fastify: FastifyInstance) {
  fastify.post('/paylinks', async (request, reply) => {
    // Scaffold: Create new payment link
    return { success: true, message: 'Payment link created' };
  });

  fastify.get('/paylinks/:link_id', async (request, reply) => {
    const { link_id } = request.params as any;
    // Scaffold: Fetch payment link details
    return { success: true, link_id };
  });

  fastify.patch('/paylinks/:link_id', async (request, reply) => {
    // Scaffold: Update or deactivate link
    return { success: true, message: 'Payment link updated' };
  });
}
