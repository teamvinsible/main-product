variable "name" {
  type        = string
  description = "Project name; used to name the VPC."
}

variable "region" {
  type        = string
  description = "DigitalOcean region slug (e.g. blr1)."
}

variable "ip_range" {
  type        = string
  description = "Private CIDR for the VPC."
  default     = "10.20.0.0/24"
}
