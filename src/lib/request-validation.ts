import { FastifyReply } from "fastify";
import { z } from "zod";

export const badRequest = (
  reply: FastifyReply,
  message: string,
  issues?: z.ZodIssue[],
) => {
  return reply.status(400).send({
    ok: false,
    message,
    issues: issues?.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
};

export const parseOrReply = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  reply: FastifyReply,
) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    badRequest(reply, "Invalid request payload.", parsed.error.issues);
    return null;
  }
  return parsed.data;
};
