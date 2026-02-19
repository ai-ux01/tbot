FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
# Exclude dev/test if needed
# COPY server.js config.js ./
# COPY database routes services kiteSessionStore.js logger.js socket.js ./

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server.js"]
