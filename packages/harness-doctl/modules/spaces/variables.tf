variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "acl" {
  type        = string
  description = "Bucket ACL. Guardrail: private by default."
  default     = "private"
}

variable "noncurrent_expiry_days" {
  type        = number
  description = "Days to retain non-current (versioned) objects before expiry."
  default     = 30
}
