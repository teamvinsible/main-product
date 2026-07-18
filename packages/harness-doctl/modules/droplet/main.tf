# The project's single Droplet. All hardening + the tailnet join + Docker data-root
# on the encrypted block volume happen via cloud-init (see cloud-init.yaml.tftpl).
locals {
  cloud_init = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname          = var.name
    headscale_url     = var.headscale_url
    tailscale_authkey = var.tailscale_authkey
    ssh_public_keys   = var.ssh_public_keys
    data_volume_name  = var.data_volume_name
  })
}

resource "digitalocean_droplet" "this" {
  name       = var.name
  region     = var.region
  size       = var.size
  image      = var.image
  vpc_uuid   = var.vpc_uuid
  ssh_keys   = var.ssh_key_ids
  volume_ids = var.volume_ids
  monitoring = true
  user_data  = local.cloud_init
  tags       = concat(["harness", var.name], var.tags)

  lifecycle {
    # user_data only applies on create; changing it should not silently no-op.
    ignore_changes = []
  }
}
