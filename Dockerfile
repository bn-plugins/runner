FROM node:20 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm

FROM base AS builder
COPY . /app
WORKDIR /app
CMD [ "node", "scripts/builder.mjs" ]