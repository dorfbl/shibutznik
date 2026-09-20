FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
EXPOSE 3015
CMD ["node", "server/index.js"]
