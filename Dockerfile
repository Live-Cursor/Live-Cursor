FROM node:18-alpine
WORKDIR /app
COPY server_daemon.js ./
RUN npm install ws yjs y-websocket cors
EXPOSE 1234
ENV DB_DIR=/app/data
ENV PORT=1234
CMD ["node", "server_daemon.js"]
