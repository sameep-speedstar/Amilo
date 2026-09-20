# Amilo browser agent — Azure ACI / AKS
# Includes Chromium for Playwright live mode.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /app
ENV NODE_ENV=production
ENV BROWSER_AGENT_MODE=demo
ENV PORT=8090

COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
COPY brain ./brain

RUN npm install \
  && npm run build -w @amilo/booking -w @amilo/db -w @amilo/browser-agent \
  && npx playwright install chromium || true

EXPOSE 8090
CMD ["npm", "run", "start", "-w", "@amilo/browser-agent"]
