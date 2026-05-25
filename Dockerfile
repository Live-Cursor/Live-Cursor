FROM node:20-alpine
WORKDIR /app
COPY server.js ./
RUN npm install ws yjs y-websocket
EXPOSE 4444
ENV PORT=4444
ENV DB_DIR=/app/data
CMD ["node", "server.js"]
