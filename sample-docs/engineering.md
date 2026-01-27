# Engineering Best Practices

## Code Review Standards

All pull requests require at least one approval before merging. Reviews should focus on:
- Logic correctness and edge cases
- Code readability and maintainability
- Test coverage for new functionality
- Security implications and data handling
- Performance considerations

PRs should be kept focused and under 400 lines when possible. Large refactors should be discussed in planning meetings first.

## Testing Requirements

Every feature branch must include:
- Unit tests for business logic (minimum 80% coverage)
- Integration tests for API endpoints
- E2E tests for critical user flows

Run the full test suite locally before pushing: `npm test && npm run test:integration`

## Git Workflow

We follow a modified GitHub Flow:
- Branch from `main` for all features: `feature/TICKET-123-short-description`
- Commit messages should reference ticket numbers: `[TICKET-123] Add user authentication`
- Rebase feature branches before merging to maintain clean history
- Delete branches after merging

## Database Migrations

Always create reversible migrations with both `up` and `down` functions. Test migrations on a copy of production data before deploying. Never modify existing migration files after they've been deployed.

Migration naming: `YYYYMMDD_HHMM_description.sql`

## Security Practices

- Never commit secrets, API keys, or credentials to version control
- Use environment variables for configuration
- Sanitize all user inputs before database queries
- Implement rate limiting on public endpoints
- Keep dependencies updated and scan for vulnerabilities weekly with `npm audit`

## Documentation

Update documentation alongside code changes:
- README.md for setup and basic usage
- API documentation for endpoint changes
- Architecture diagrams for system design changes
- Inline comments for complex business logic only

## Deployment Process

Deployments occur during business hours (9 AM - 5 PM PT) unless emergency hotfixes are required. Always:
1. Notify #engineering channel before deploying
2. Monitor error logs for 15 minutes post-deployment
3. Have rollback plan ready
4. Update deployment log in Notion

## Performance Guidelines

- Database queries should complete under 100ms
- API response times should stay under 200ms for p95
- Monitor application metrics in Datadog
- Profile before optimizing - measure, don't guess

## Code Style

We use Prettier and ESLint for automated formatting. Run `npm run lint:fix` before committing. Follow the principle: write code for humans first, computers second.