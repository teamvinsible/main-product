# DO Cloud Firewall: default-deny inbound. Only 80/443 public; admin is tailnet-only
# (no public SSH). UDP 41641 lets tailscale make direct connections (WireGuard,
# authenticated) instead of always relaying. Egress is open (packages, Spaces, ACME).
resource "digitalocean_firewall" "this" {
  name        = "${var.name}-fw"
  droplet_ids = [var.droplet_id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "udp"
    port_range       = "41641"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # SSH only from explicitly allowed CIDRs (default: none — use the tailnet).
  dynamic "inbound_rule" {
    for_each = var.allow_ssh_cidrs
    content {
      protocol         = "tcp"
      port_range       = "22"
      source_addresses = [inbound_rule.value]
    }
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
