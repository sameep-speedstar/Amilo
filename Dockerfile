FROM node:22.14-bookworm-slim AS build
WORKDIR /app
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY brain ./brain
COPY tsconfig.base.json ./
# @cursor/sdk pulls sqlite3 (native) — need compilers in the build stage only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install
RUN npm run build

FROM node:22.14-bookworm-slim
WORKDIR /app
ARG GIT_SHA=unknown
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
EXPOSE 8080
CMD ["sh", "-c", "npm run migrate -w @amilo/db && npm run start -w @amilo/api"]
