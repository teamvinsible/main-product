output "id" {
  value = digitalocean_droplet.this.id
}

output "ipv4" {
  value = digitalocean_droplet.this.ipv4_address
}

output "ipv4_private" {
  value = digitalocean_droplet.this.ipv4_address_private
}

output "tailnet_host" {
  value       = var.name
  description = "Hostname on the tailnet (admin reaches the Droplet here, not via public SSH)."
}
