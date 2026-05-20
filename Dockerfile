FROM node:18-alpine
WORKDIR /app
COPY server_daemon.js ./
RUN npm install ws yjs lib0 y-protocols y-websocket
EXPOSE 1234
ENV DB_DIR=/app/data
ENV PORT=1234
CMD ["node", "server_daemon.js"]
