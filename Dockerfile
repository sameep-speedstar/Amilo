FROM node:22.14-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN npm install
RUN npm run build

FROM node:22.14-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@amilo/api"]
