# Encrypted block volume for all container/DB data. DO volumes are encrypted at
# rest. Attached to the Droplet and used as Docker's data-root (see cloud-init).
resource "digitalocean_volume" "this" {
  name                    = var.name
  region                  = var.region
  size                    = var.size_gib
  initial_filesystem_type = "ext4"
  description             = "Encrypted data volume for ${var.name}"
}
