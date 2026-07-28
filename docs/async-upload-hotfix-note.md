# Async upload acknowledge-first hotfix

The upload request must persist the PDF job and return HTTP 202 before contacting OpenAI. The Railway process then submits queued jobs in the background. PDF bytes are stored temporarily in PostgreSQL and cleared immediately after OpenAI accepts the background response.
