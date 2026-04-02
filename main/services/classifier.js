const GROUP_RULES = [
  {
    group: 'dev',
    icon: '🟢',
    label: 'Dev Processes',
    match: (name) =>
      /^(node|python|python3|java|javaw|dotnet|ruby|go|cargo|rustc|npm|npx|pip|gradle|mvn|maven|webpack|vite|tsc|esbuild|bun|deno)/i.test(name),
  },
  {
    group: 'docker',
    icon: '🐳',
    label: 'Docker',
    match: (name) =>
      /^(docker|com\.docker|vpnkit|hyperkit|containerd|moby)/i.test(name),
  },
  {
    group: 'databases',
    icon: '🗄️',
    label: 'Databases',
    match: (name) =>
      /^(postgres|pg_|mysqld?|mariadb|mongod|mongos|redis-server|redis-cli|memcached|sqlite|cockroach)/i.test(name),
  },
  {
    group: 'apps',
    icon: '🔵',
    label: 'Apps',
    match: (name) =>
      /^(teams|slack|spotify|discord|code|chrome|firefox|msedge|edge|brave|opera|thunderbird|outlook|notepad\+\+|gitkraken|postman|insomnia)/i.test(name),
  },
];

const PORT_GROUP_MAP = {
  5432: 'databases',
  3306: 'databases',
  27017: 'databases',
  6379: 'databases',
  11211: 'databases',
  2375: 'docker',
  2376: 'docker',
};

const GROUP_META = {
  dev: { icon: '🟢', label: 'Dev Processes', order: 0 },
  docker: { icon: '🐳', label: 'Docker', order: 1 },
  databases: { icon: '🗄️', label: 'Databases', order: 2 },
  apps: { icon: '🔵', label: 'Apps', order: 3 },
  system: { icon: '⚙️', label: 'System', order: 4 },
};

function classify(processName, ports) {
  // Try name-based classification first
  for (const rule of GROUP_RULES) {
    if (rule.match(processName)) {
      return rule.group;
    }
  }

  // Try port-based classification
  if (ports && ports.length > 0) {
    for (const port of ports) {
      if (PORT_GROUP_MAP[port]) {
        return PORT_GROUP_MAP[port];
      }
    }
  }

  return 'system';
}

module.exports = { classify, GROUP_META };
