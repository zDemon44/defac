import "dotenv/config";

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

export function getDatabaseConfig(): DatabaseConfig {
  const port = Number(process.env.DB_PORT ?? "3306");
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT ?? "5");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT no es valido.");
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 20) throw new Error("DB_CONNECTION_LIMIT debe estar entre 1 y 20.");
  const user = process.env.DB_USER?.trim();
  if (!user) throw new Error("Configure DB_USER en el archivo .env.");
  return {
    host: process.env.DB_HOST?.trim() || "127.0.0.1",
    port,
    user,
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME?.trim() || "defac-base",
    connectionLimit,
  };
}
