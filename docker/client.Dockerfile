FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}
COPY package*.json ./
RUN npm install
COPY client ./client
RUN npx vite build client

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
