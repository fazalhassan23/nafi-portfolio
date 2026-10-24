FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js content-store.js database.js media-storage.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/appointments.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
