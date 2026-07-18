variable "name" {
  type        = string
  description = "Project name; used as Droplet name and tailnet hostname."
}

variable "region" {
  type = string
}

variable "size" {
  type    = string
  default = "s-2vcpu-4gb"
}

variable "image" {
  type    = string
  default = "ubuntu-24-04-x64"
}

variable "vpc_uuid" {
  type = string
}

variable "ssh_key_ids" {
  type        = list(string)
  description = "DO SSH key fingerprints/IDs for initial provisioning access."
  default     = []
}

variable "ssh_public_keys" {
  type        = list(string)
  description = "Public keys authorized for the non-root 'deploy' user."
  default     = []
}

variable "headscale_url" {
  type        = string
  description = "Headscale control server URL the Droplet joins (self-hosted tailnet)."
}

variable "tailscale_authkey" {
  type        = string
  sensitive   = true
  description = "Pre-auth key for the tailnet join."
  default     = ""
}

variable "volume_ids" {
  type        = list(string)
  description = "Block volume IDs to attach (Docker data-root lives here)."
  default     = []
}

variable "data_volume_name" {
  type        = string
  description = "Name of the attached data volume (used to find its device in cloud-init)."
  default     = ""
}

variable "tags" {
  type    = list(string)
  default = []
}
