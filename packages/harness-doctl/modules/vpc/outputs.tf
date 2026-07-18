output "vpc_uuid" {
  value       = digitalocean_vpc.this.id
  description = "UUID of the created VPC."
}
