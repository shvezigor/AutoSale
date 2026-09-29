import {
  configureRuntimeDatabaseRoles,
  runtimeDatabaseRoleConfigFromEnv,
} from './runtime-database-roles.js';

const config = runtimeDatabaseRoleConfigFromEnv(process.env);

await configureRuntimeDatabaseRoles(config.connectionString, config.passwords);

console.log('Runtime database roles configured');
