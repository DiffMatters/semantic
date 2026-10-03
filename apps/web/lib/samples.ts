/** Built-in sample pairs for trying the tool without files. */
import type { Preset } from "./options";
import type { SourceState } from "./parse-source";

export interface Sample {
  id: string;
  label: string;
  /** Preset applied together with the sample so the result is meaningful. */
  preset: Preset["id"];
  left: SourceState;
  right: SourceState;
}

const JSON_BASE = `{
  "service": "orders",
  "version": "1.10.0",
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "tls": false,
    "timeoutMs": 30000
  },
  "database": {
    "host": "db.internal",
    "port": 5432,
    "password": "dev-secret",
    "replica": ""
  },
  "features": ["search", "export"],
  "retries": 3
}
`;

const YAML_PROD = `service: orders
version: 1.11.0
server:
  host: 0.0.0.0
  port: "8080"
  tls: true
  timeout_ms: 30000
database:
  host: db-primary.prod.internal
  port: 5432
  password: Pr0d-P@ss
  replica: null
features:
  - search
  - export
  - audit
retries: [3]
`;

const YAML_APP = `app:
  name: billing
  debug: false
  log_level: info
http:
  port: 9000
  allowed_origins:
    - https://app.example.com
    - https://admin.example.com
cache:
  ttl_s: 300
  enabled: true
`;

const ENV_APP = `# Production .env; "__" nests keys
APP__NAME=billing
APP__DEBUG=false
APP__LOG_LEVEL=warn
HTTP__PORT=9000
HTTP__ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CACHE__TTL_S=300
CACHE__ENABLED=yes
SENTRY__DSN=https://key@sentry.example.com/1
`;

const DRIFT_BASE = `{
  "replicas": 2,
  "image": "registry.example.com/web:1.4.2",
  "resources": { "cpu": "500m", "memory": "512Mi" },
  "env": { "LOG_LEVEL": "info", "FEATURE_X": "false" },
  "ports": [80, 443],
  "healthcheck": { "path": "/healthz", "intervalS": 10 }
}
`;

const DRIFT_LIVE = `{
  "replicas": 3,
  "image": "registry.example.com/web:1.4.2",
  "resources": { "cpu": "500m", "memory": 512 },
  "env": { "LOG_LEVEL": "debug", "FEATURE_X": "false", "HOTFIX": "1" },
  "ports": [443, 80]
}
`;

export const SAMPLES: readonly Sample[] = [
  {
    id: "json-yaml",
    label: "JSON vs YAML (service config)",
    preset: "cross-format",
    left: { text: JSON_BASE, name: "app.base.json", format: "auto" },
    right: { text: YAML_PROD, name: "app.prod.yaml", format: "auto" },
  },
  {
    id: "yaml-env",
    label: "YAML vs .env (__ nesting)",
    preset: "cross-format",
    left: { text: YAML_APP, name: "billing.yaml", format: "auto" },
    right: { text: ENV_APP, name: "billing.env", format: "auto" },
  },
  {
    id: "drift",
    label: "Drift: deployed vs baseline",
    preset: "drift",
    left: { text: DRIFT_BASE, name: "baseline.json", format: "auto" },
    right: { text: DRIFT_LIVE, name: "live.json", format: "auto" },
  },
];
