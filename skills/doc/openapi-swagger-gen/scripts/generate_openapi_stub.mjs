const pathName = process.argv[2] || "/api/v1/health";
console.log(JSON.stringify({
  openapi: "3.0.3",
  info: { title: "API Service", version: "1.0.0" },
  paths: {
    [pathName]: {
      get: {
        summary: "Endpoint " + pathName,
        responses: {
          "200": {
            description: "Successful response",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    }
  }
}, null, 2));
