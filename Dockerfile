# ---- build stage: compile the React frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- runtime stage: backend serves API + built frontend ----
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend --omit=dev
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./backend/public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/backend/src/data"]
CMD ["node", "backend/src/server.js"]
