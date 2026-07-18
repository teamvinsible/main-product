variable "name" {
  type = string
}

variable "droplet_id" {
  type = string
}

variable "allow_ssh_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach public SSH (22). Default none — admin via tailnet."
  default     = []
}
