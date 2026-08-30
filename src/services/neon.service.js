const axios = require("axios");

const neonApi = axios.create({
  baseURL: process.env.NEON_API_URL || "https://console.neon.tech/api/v2",
  timeout: 30000,
  headers: { Accept: "application/json", "Content-Type": "application/json" },
});

function createProjectPayload(projectName, databaseName) {
  return {
    project: {
      name: projectName,
      region_id: process.env.NEON_REGION || "aws-us-east-2",
      pg_version: Number(process.env.NEON_PG_VERSION || 16),
      branch: {
        name: process.env.NEON_BRANCH_NAME || "main",
        database_name: databaseName,
        role_name: process.env.NEON_ROLE_NAME || "neondb_owner",
      },
    },
  };
}

function getConnectionString(project, databaseName) {
  const connectionUris = project.connection_uris || project.connectionUris || [];
  const matchingUri = connectionUris.find(
    (uri) =>
      uri.database_name === databaseName || uri.databaseName === databaseName,
  );

  return (
    matchingUri?.connection_uri ||
    matchingUri?.connectionUri ||
    connectionUris[0]?.connection_uri ||
    connectionUris[0]?.connectionUri ||
    project.connection_uri ||
    project.connectionUri ||
    project.connection_string ||
    project.connectionString ||
    null
  );
}

async function createTenantProject({ projectName, databaseName }) {
  if (!process.env.NEON_API_KEY) {
    throw new Error("NEON_API_KEY is required to provision tenant databases");
  }

  const headers = { Authorization: `Bearer ${process.env.NEON_API_KEY}` };
  const response = await neonApi.post(
    "/projects",
    createProjectPayload(projectName, databaseName),
    { headers },
  );
  const project = response.data.project || response.data;
  let connectionString = getConnectionString(response.data, databaseName);
  if (!connectionString) {
    connectionString = getConnectionString(project, databaseName);
  }

  if (!connectionString && project.id) {
    const uriResponse = await neonApi.get(
      `/projects/${project.id}/connection_uri`,
      {
        params: {
          database_name: databaseName,
          role_name: process.env.NEON_ROLE_NAME || "neondb_owner",
        },
        headers,
      },
    );
    connectionString =
      uriResponse.data.connection_uri || uriResponse.data.connectionUri;
  }

  if (!project.id || !connectionString) {
    throw new Error("Neon did not return a tenant connection string");
  }

  return { projectId: project.id, connectionString };
}

async function deleteTenantProject(projectId) {
  if (!projectId || !process.env.NEON_API_KEY) return;
  await neonApi.delete(`/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}` },
  });
}

module.exports = { createTenantProject, deleteTenantProject };
