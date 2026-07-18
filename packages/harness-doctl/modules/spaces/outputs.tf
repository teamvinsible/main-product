output "name" {
  value = digitalocean_spaces_bucket.this.name
}

output "domain" {
  value = digitalocean_spaces_bucket.this.bucket_domain_name
}

output "endpoint" {
  value = digitalocean_spaces_bucket.this.endpoint
}
