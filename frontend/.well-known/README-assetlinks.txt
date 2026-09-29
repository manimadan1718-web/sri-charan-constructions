This is a PLACEHOLDER, not yet valid — it will not verify anything until Phase 3.

When you run Bubblewrap in Phase 3, it will print an applicationId (e.g.
com.sricharanconstructions.sitelog) and a SHA-256 fingerprint. Replace:
  - package_name              → the applicationId
  - sha256_cert_fingerprints  → the fingerprint, in AA:BB:CC:... form

Then redeploy and confirm it at:
  https://<your-domain>/.well-known/assetlinks.json
  https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<your-domain>&relation=delegate_permission/common.handle_all_urls
