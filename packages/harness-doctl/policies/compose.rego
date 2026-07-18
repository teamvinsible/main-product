package main

deny[msg] {
  service := input.services[name]
  name != "caddy"
  service.ports
  msg := sprintf("service %q publishes host ports; only caddy may publish ports", [name])
}

deny[msg] {
  service := input.services[name]
  startswith(name, "postgres")
  service.ports
  msg := sprintf("database service %q publishes host ports", [name])
}
