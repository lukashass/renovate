import equal from 'fast-deep-equal';
import { ReleaseType, inc } from 'semver';
import { logger } from '../../logger';
import { matchAt, replaceAt } from '../../util/string';
import { UpdateDependencyConfig } from '../common';

export function bumpPackageVersion(
  content: string,
  currentValue: string,
  bumpVersion: ReleaseType | string
): string {
  if (!bumpVersion) {
    return content;
  }
  logger.debug(
    { bumpVersion, currentValue },
    'Checking if we should bump package.json version'
  );
  let newPjVersion: string;
  try {
    if (bumpVersion.startsWith('mirror:')) {
      const mirrorPackage = bumpVersion.replace('mirror:', '');
      const parsedContent = JSON.parse(content);
      newPjVersion =
        (parsedContent.dependencies || {})[mirrorPackage] ||
        (parsedContent.devDependencies || {})[mirrorPackage] ||
        (parsedContent.optionalDependencies || {})[mirrorPackage] ||
        (parsedContent.peerDependencies || {})[mirrorPackage];
      if (!newPjVersion) {
        logger.warn('bumpVersion mirror package not found: ' + mirrorPackage);
        return content;
      }
    } else {
      newPjVersion = inc(currentValue, bumpVersion as ReleaseType);
    }
    logger.debug({ newPjVersion });
    const bumpedContent = content.replace(
      /("version":\s*")[^"]*/,
      `$1${newPjVersion}`
    );
    if (bumpedContent === content) {
      logger.debug('Version was already bumped');
    } else {
      logger.debug('Bumped package.json version');
    }
    return bumpedContent;
  } catch (err) {
    logger.warn(
      {
        content,
        currentValue,
        bumpVersion,
      },
      'Failed to bumpVersion'
    );
    return content;
  }
}

export function updateDependency({
  fileContent,
  upgrade,
}: UpdateDependencyConfig): string | null {
  const { depType, managerData } = upgrade;
  const depName: string = managerData?.key || upgrade.depName;
  let { newValue } = upgrade;
  if (upgrade.currentRawValue) {
    if (upgrade.currentDigest) {
      logger.debug('Updating package.json git digest');
      newValue = upgrade.currentRawValue.replace(
        upgrade.currentDigest,
        upgrade.newDigest.substring(0, upgrade.currentDigest.length)
      );
    } else {
      logger.debug('Updating package.json git version tag');
      newValue = upgrade.currentRawValue.replace(
        upgrade.currentValue,
        upgrade.newValue
      );
    }
  }
  if (upgrade.npmPackageAlias) {
    newValue = `npm:${upgrade.lookupName}@${newValue}`;
  }
  logger.debug(`npm.updateDependency(): ${depType}.${depName} = ${newValue}`);
  try {
    const parsedContents = JSON.parse(fileContent);
    // Save the old version
    const oldVersion: string = parsedContents[depType][depName];
    if (oldVersion === newValue) {
      logger.trace('Version is already updated');
      return bumpPackageVersion(
        fileContent,
        upgrade.packageFileVersion,
        upgrade.bumpVersion
      );
    }
    // Update the file = this is what we want
    parsedContents[depType][depName] = newValue;
    // Look for the old version number
    const searchString = `"${oldVersion}"`;
    const newString = `"${newValue}"`;
    let newFileContent = null;
    // Skip ahead to depType section
    let searchIndex = fileContent.indexOf(`"${depType}"`) + depType.length;
    logger.trace(`Starting search at index ${searchIndex}`);
    // Iterate through the rest of the file
    for (; searchIndex < fileContent.length; searchIndex += 1) {
      // First check if we have a hit for the old version
      if (matchAt(fileContent, searchIndex, searchString)) {
        logger.trace(`Found match at index ${searchIndex}`);
        // Now test if the result matches
        const testContent = replaceAt(
          fileContent,
          searchIndex,
          searchString,
          newString
        );
        // Compare the parsed JSON structure of old and new
        if (equal(parsedContents, JSON.parse(testContent))) {
          newFileContent = testContent;
          break;
        }
      }
    }
    // istanbul ignore if
    if (!newFileContent) {
      logger.debug(
        { fileContent, parsedContents, depType, depName, newValue },
        'Warning: updateDependency error'
      );
      return fileContent;
    }
    if (parsedContents?.resolutions) {
      let depKey: string;
      if (parsedContents.resolutions[depName]) {
        depKey = depName;
      } else if (parsedContents.resolutions[`**/${depName}`]) {
        depKey = `**/${depName}`;
      }
      if (depKey) {
        // istanbul ignore if
        if (parsedContents.resolutions[depKey] !== oldVersion) {
          logger.debug(
            {
              depName,
              depKey,
              oldVersion,
              resolutionsVersion: parsedContents.resolutions[depKey],
            },
            'Upgraded dependency exists in yarn resolutions but is different version'
          );
        }
        // Look for the old version number
        const oldResolution = `"${String(parsedContents.resolutions[depKey])}"`;
        const newResolution = `"${newValue}"`;
        // Update the file = this is what we want
        parsedContents.resolutions[depKey] = newValue;
        // Skip ahead to depType section
        searchIndex = newFileContent.indexOf(`"resolutions"`);
        logger.trace(`Starting search at index ${searchIndex}`);
        // Iterate through the rest of the file
        for (; searchIndex < newFileContent.length; searchIndex += 1) {
          // First check if we have a hit for the old version
          if (matchAt(newFileContent, searchIndex, oldResolution)) {
            logger.trace(`Found match at index ${searchIndex}`);
            // Now test if the result matches
            const testContent = replaceAt(
              newFileContent,
              searchIndex,
              oldResolution,
              newResolution
            );
            // Compare the parsed JSON structure of old and new
            if (equal(parsedContents, JSON.parse(testContent))) {
              newFileContent = testContent;
              break;
            }
          }
        }
      }
    }
    return bumpPackageVersion(
      newFileContent,
      upgrade.packageFileVersion,
      upgrade.bumpVersion
    );
  } catch (err) {
    logger.debug({ err }, 'updateDependency error');
    return null;
  }
}
