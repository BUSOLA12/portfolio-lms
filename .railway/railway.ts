import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const portfolioLms = github("BUSOLA12/portfolio-lms", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "ams" });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 500 });
  const api = service("api", {
    source: portfolioLms,
    build: "npm install && npm run build --workspace @platform/api",
    start: "npm run start --workspace @platform/api",
    healthcheck: "/health",
    replicas: { "ams": 1 },
    deploy: { preDeployCommand: ["npx prisma migrate deploy --schema apps/api/prisma/schema.prisma"] },
    networking: { privateNetworkEndpoint: "portfolio-lms" },
    env: { DATABASE_URL: preserve() },
  });
  const web = service("web", {
    source: portfolioLms,
    build: "npm run build --workspace @platform/web",
    start: "npm run start --workspace @platform/web",
    replicas: { "ams": 1 },
    networking: { privateNetworkEndpoint: "portfolio-lms-8cd7" },
    env: { NEXT_PUBLIC_API_URL: preserve(), NODE_ENV: preserve() },
  });

  return project("confident-light", {
    resources: [api, web, Postgres, postgresVolume],
  });
});
