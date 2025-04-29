import { pipeline } from 'node:stream/promises'
import conventionalChangelog from 'conventional-changelog'
import _debug from 'debug'
import gitSemverTags from 'git-semver-tags'
import semver from 'semver'
import { Octokit } from '@octokit/rest'

const debug = _debug('conventional-github-releaser')

/* eslint max-params: ["error", 7] */
export async function conventionalGithubReleaser (
  auth,
  changelogOpts = {},
  context = {},
  gitRawCommitsOpts = {},
  parserOpts = {},
  writerOpts = {},
) {
  if (!auth) {
    throw new Error('Expected an auth object')
  }

  changelogOpts = {
    releaseCount: 1,
    ...changelogOpts,
  }

  writerOpts.includeDetails = true

  // ignore the default header partial
  writerOpts.headerPartial = writerOpts.headerPartial || ''

  const tags = await gitSemverTags()

  if (!tags || !tags.length) {
    throw new Error('No semver tags found')
  }

  const releaseCount = changelogOpts.releaseCount
  if (releaseCount !== 0) {
    gitRawCommitsOpts = {
      from: tags[releaseCount],
      ...gitRawCommitsOpts,
    }
  }

  gitRawCommitsOpts.to = gitRawCommitsOpts.to || tags[0]

  const stream = conventionalChangelog(changelogOpts, context, gitRawCommitsOpts, parserOpts, writerOpts)

  stream.on('error', (err) => {
    throw err
  })

  const octokit = new Octokit({
    auth: auth.token,
  })
  return await pipeline(
    stream,
    async function * (source) {
      for await (const chunk of source) {
        if (!chunk.keyCommit?.version) {
          debug('No commit version')
          continue
        }

        const options = {
          owner: context.owner,
          repo: context.repository,
          body: chunk.log,
          draft: changelogOpts.draft || false,
          name: changelogOpts.name || chunk.keyCommit.version,
          prerelease: semver.parse(chunk.keyCommit.version).prerelease.length > 0,
          tag_name: chunk.keyCommit.version,
          target_commitish: changelogOpts.targetCommitish,
        }
        debug('creating release with %o', options)

        // Set auth after debug output so that we don't print auth token to console.
        options.token = auth.token

        yield await octokit.rest.repos.createRelease(options)
      }
    },
  )
}
