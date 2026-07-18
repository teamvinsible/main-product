# DO Spaces bucket (S3-compatible). Private ACL by default; versioning on so a
# bad overwrite/ransomware event is recoverable (threat model B7).
resource "digitalocean_spaces_bucket" "this" {
  name   = var.name
  region = var.region
  acl    = var.acl

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "expire-noncurrent"
    enabled = true
    noncurrent_version_expiration {
      days = var.noncurrent_expiry_days
    }
  }
}
