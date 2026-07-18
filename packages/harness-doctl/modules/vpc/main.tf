# Private network for the project. All resources join this VPC; nothing is
# reachable except through the edge (Caddy) and the tailnet.
resource "digitalocean_vpc" "this" {
  name     = "${var.name}-vpc"
  region   = var.region
  ip_range = var.ip_range
}
