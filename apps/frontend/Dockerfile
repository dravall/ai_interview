FROM oven/bun:1
WORKDIR /repo

COPY . .
RUN bun install --frozen-lockfile

WORKDIR /repo/apps/frontend
EXPOSE 3000
CMD ["bun", "run", "start"]
