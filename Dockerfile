FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R app:app /app/data
USER app

EXPOSE 3000
ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
