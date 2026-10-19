FROM oven/bun:1.3.11
WORKDIR /repo

COPY . .
RUN bun install --frozen-lockfile

WORKDIR /repo/apps/backend
EXPOSE 3001
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start"]
